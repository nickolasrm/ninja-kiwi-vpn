// Windows bootstrap for a ZIP payload appended to this executable.
package main

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

var payloadVersion string

func main() {
	if err := launch(); err != nil {
		message, _ := syscall.UTF16PtrFromString(err.Error())
		title, _ := syscall.UTF16PtrFromString("Ninja Kiwi VPN")
		syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(
			0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x10,
		)
	}
}

func launch() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return err
	}
	root := filepath.Join(cache, "Ninja Kiwi VPN")
	version := filepath.Join(root, payloadVersion)
	program := filepath.Join(version, "NinjaKiwiVPN.exe")
	if _, err := os.Stat(program); os.IsNotExist(err) {
		if err := os.MkdirAll(root, 0700); err != nil {
			return err
		}
		staging, err := os.MkdirTemp(root, "unpack-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(staging)
		if err := extract(executable, staging); err != nil {
			return fmt.Errorf("Couldn’t unpack Ninja Kiwi VPN: %w", err)
		}
		if err := os.Rename(staging, version); err != nil {
			if _, installed := os.Stat(program); installed != nil {
				return err
			}
		}
	}
	args := os.Args[1:]
	cmd := exec.Command(program, args...)
	cmd.Dir = version
	return cmd.Start()
}

func extract(executable, destination string) error {
	archive, err := zip.OpenReader(executable)
	if err != nil {
		return err
	}
	defer archive.Close()

	for _, source := range archive.File {
		name := filepath.FromSlash(source.Name)
		if !filepath.IsLocal(name) || !source.Mode().IsRegular() {
			return fmt.Errorf("Invalid bundle entry %q", source.Name)
		}
		target := filepath.Join(destination, name)
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		if err := extractFile(source, target); err != nil {
			return err
		}
	}
	return nil
}

func extractFile(source *zip.File, target string) error {
	input, err := source.Open()
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, copyError := io.Copy(output, input)
	closeError := output.Close()
	if copyError != nil {
		return copyError
	}
	return closeError
}
